#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dwmapi.h>
#include <cstdio>
#include <cwchar>
#include <algorithm>
#include <map>
#include <string>
#include <atomic>
#include <cstring>

// BetterNCM 1.3.4's public native-plugin ABI. No CEF detours or injection.
enum NativeAPIType { Int, Boolean, Double, String, V8Value };
struct PluginAPI {
    int (*addNativeAPI)(NativeAPIType[], int, const char*, char* (*)(void**));
    const char* betterncmVersion;
    int processType;
    const unsigned short (*ncmVersion)[3];
};
static HMODULE module;
static std::wstring configPath;
static std::wstring settingsPath;
static NativeAPIType settingsTypes[] = {String};
static SRWLOCK settingsLock = SRWLOCK_INIT;
static thread_local std::string settingsResponse;
static std::atomic<bool> started{false};
static const wchar_t* marker = L"MacGlassNativeOwned";
static NativeAPIType configureTypes[] = {Int, Int, Int};
static thread_local char response[1024];
struct OriginalState { LONG_PTR exstyle; DWORD key, flags; BYTE alpha; int backdrop; bool hadAlpha; };
static std::map<HWND, OriginalState> originals; // accessed only by the main worker

static bool targetWindow(HWND hwnd, DWORD processId = 0) {
    DWORD owner = 0;
    GetWindowThreadProcessId(hwnd, &owner);
    if (processId && owner != processId) return false;
    wchar_t className[128] = {}, title[512] = {};
    GetClassNameW(hwnd, className, 128);
    GetWindowTextW(hwnd, title, 512);
    // Do not modify DevTools, consoles, mini windows or other applications.
    return wcscmp(className, L"OrpheusBrowserHost") == 0 &&
           wcsncmp(title, L"BetterNCM DevTools", 18) != 0;
}

static DWORD apply(HWND hwnd, BYTE alpha, bool enabled) {
    if (!IsWindow(hwnd) || !targetWindow(hwnd)) return ERROR_INVALID_WINDOW_HANDLE;
    auto found = originals.find(hwnd);
    if (!enabled) {
        if (found == originals.end()) return ERROR_SUCCESS;
        const auto saved = found->second;
        if (saved.hadAlpha) SetLayeredWindowAttributes(hwnd, saved.key, saved.alpha, saved.flags);
        else SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
        // Only undo our own WS_EX_LAYERED bit. Preserve app changes to other bits.
        if (!(saved.exstyle & WS_EX_LAYERED)) {
            auto style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style & ~WS_EX_LAYERED);
        }
        DwmSetWindowAttribute(hwnd, 38, &saved.backdrop, sizeof(saved.backdrop));
        RemovePropW(hwnd, marker);
        originals.erase(found);
        return ERROR_SUCCESS;
    }
    if (found == originals.end()) {
        OriginalState saved{};
        saved.exstyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        saved.hadAlpha = GetLayeredWindowAttributes(hwnd, &saved.key, &saved.alpha, &saved.flags) != FALSE;
        DwmGetWindowAttribute(hwnd, 38, &saved.backdrop, sizeof(saved.backdrop));
        // Do not take over a layered window already controlled by another theme.
        if (saved.exstyle & WS_EX_LAYERED) return ERROR_ALREADY_EXISTS;
        if (!SetPropW(hwnd, marker, reinterpret_cast<HANDLE>(1))) return GetLastError();
        originals.emplace(hwnd, saved);
    }
    SetLastError(0);
    const auto style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED);
    if (GetLastError()) return GetLastError();
    if (!SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA)) return GetLastError();
    DWORD key = 0, flags = 0; BYTE actual = 0;
    if (!GetLayeredWindowAttributes(hwnd, &key, &actual, &flags)) return GetLastError();
    if (actual != alpha || flags != LWA_ALPHA) return ERROR_INVALID_DATA;
    // This is only a system material request, NOT evidence of visible frosted glass.
    int backdrop = 3;
    DwmSetWindowAttribute(hwnd, 38, &backdrop, sizeof(backdrop));
    return ERROR_SUCCESS;
}

struct ApplyContext { DWORD pid; BYTE alpha; bool enabled; int count; DWORD error; };
static BOOL CALLBACK enumerate(HWND hwnd, LPARAM data) {
    auto& context = *reinterpret_cast<ApplyContext*>(data);
    if (targetWindow(hwnd, context.pid)) {
        ++context.count;
        auto error = apply(hwnd, context.alpha, context.enabled);
        if (error) context.error = error;
    }
    return TRUE;
}

static DWORD WINAPI worker(void*) {
    for (;;) {
        for (auto it = originals.begin(); it != originals.end();) {
            if (!IsWindow(it->first) || !GetPropW(it->first, marker)) it = originals.erase(it);
            else ++it;
        }
        const bool enabled = GetPrivateProfileIntW(L"window", L"enabled", 1, configPath.c_str()) != 0;
        const int alpha = std::clamp(static_cast<int>(GetPrivateProfileIntW(L"window", L"alpha", 210, configPath.c_str())), 100, 255);
        ApplyContext context{GetCurrentProcessId(), static_cast<BYTE>(alpha), enabled, 0, 0};
        EnumWindows(enumerate, reinterpret_cast<LPARAM>(&context));
        Sleep(500);
    }
}

static char* configure(void** args) {
    const int enabled = *static_cast<int*>(args[0]) ? 1 : 0;
    const int mainAlpha = std::clamp(*static_cast<int*>(args[1]), 100, 255);
    const int pageAlpha = std::clamp(*static_cast<int*>(args[2]), 100, 255);
    // The third argument selects the CURRENT page alpha; JS sends main alpha
    // while the main view is visible, and page alpha while the lyrics portal is visible.
    wchar_t value[16];
    swprintf_s(value, L"%d", pageAlpha);
    const bool alphaSaved = WritePrivateProfileStringW(L"window", L"alpha", value, configPath.c_str()) != FALSE;
    swprintf_s(value, L"%d", mainAlpha);
    const bool mainSaved = WritePrivateProfileStringW(L"window", L"mainAlpha", value, configPath.c_str()) != FALSE;
    swprintf_s(value, L"%d", enabled);
    const bool enabledSaved = WritePrivateProfileStringW(L"window", L"enabled", value, configPath.c_str()) != FALSE;
    sprintf_s(response, "{\"saved\":%s,\"mode\":\"whole-window-alpha\",\"alpha\":%d,\"enabled\":%s}",
              alphaSaved && mainSaved && enabledSaved ? "true" : "false", pageAlpha, enabled ? "true" : "false");
    return response;
}

struct StatusContext { int count; bool layered; BYTE alpha; DWORD flags; };
static BOOL CALLBACK readStatus(HWND hwnd, LPARAM data) {
    if (!targetWindow(hwnd) || !GetPropW(hwnd, marker)) return TRUE;
    auto& context = *reinterpret_cast<StatusContext*>(data);
    DWORD key = 0;
    if (GetLayeredWindowAttributes(hwnd, &key, &context.alpha, &context.flags)) {
        context.layered = (context.flags & LWA_ALPHA) != 0;
        ++context.count;
    }
    return TRUE;
}
static char* status(void**) {
    StatusContext context{};
    EnumWindows(readStatus, reinterpret_cast<LPARAM>(&context));
    sprintf_s(response, "{\"windows\":%d,\"layered\":%s,\"alpha\":%d,\"flags\":%lu,\"mode\":\"whole-window-alpha\",\"desktopBlurAdjustable\":false}",
              context.count, context.layered ? "true" : "false", context.alpha, context.flags);
    return response;
}

static char* loadSettings(void**) {
    HANDLE file = CreateFileW(settingsPath.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE,
                              nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        const DWORD error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND) {
            const int alpha = std::clamp(static_cast<int>(GetPrivateProfileIntW(L"window", L"mainAlpha", 204, configPath.c_str())), 100, 255);
            const bool enabled = GetPrivateProfileIntW(L"window", L"enabled", 1, configPath.c_str()) != 0;
            sprintf_s(response, "{\"ok\":true,\"settings\":null,\"legacyAlpha\":%d,\"legacyEnabled\":%s}", alpha, enabled ? "true" : "false");
        } else sprintf_s(response, "{\"ok\":false,\"error\":%lu}", error);
        return response;
    }
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(file, &size) || size.QuadPart < 2 || size.QuadPart > 16384) {
        CloseHandle(file);
        return const_cast<char*>("{\"ok\":false,\"error\":13}");
    }
    std::string contents(static_cast<size_t>(size.QuadPart), '\0');
    DWORD count = 0;
    const bool read = ReadFile(file, contents.data(), static_cast<DWORD>(contents.size()), &count, nullptr) && count == contents.size();
    CloseHandle(file);
    if (!read) return const_cast<char*>("{\"ok\":false,\"error\":30}");
    settingsResponse = "{\"ok\":true,\"settings\":" + contents + "}";
    return settingsResponse.data();
}

static char* saveSettings(void** args) {
    const char* json = static_cast<const char*>(args[0]);
    const size_t length = strnlen_s(json, 16385);
    if (length < 2 || length > 16384 || json[0] != '{' || json[length - 1] != '}')
        return const_cast<char*>("{\"saved\":false,\"error\":13}");
    AcquireSRWLockExclusive(&settingsLock);
    const auto temporary = settingsPath + L"." + std::to_wstring(GetCurrentProcessId()) + L".tmp";
    HANDLE file = CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    DWORD error = ERROR_SUCCESS, written = 0;
    if (file == INVALID_HANDLE_VALUE) error = GetLastError();
    else {
        if (!WriteFile(file, json, static_cast<DWORD>(length), &written, nullptr) || written != length || !FlushFileBuffers(file))
            error = ERROR_WRITE_FAULT;
        CloseHandle(file);
        if (!error && !MoveFileExW(temporary.c_str(), settingsPath.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
            error = GetLastError();
    }
    if (error) DeleteFileW(temporary.c_str());
    ReleaseSRWLockExclusive(&settingsLock);
    sprintf_s(response, "{\"saved\":%s,\"error\":%lu}", error ? "false" : "true", error);
    return response;
}

extern "C" __declspec(dllexport) int BetterNCMPluginMain(PluginAPI* api) {
    wchar_t path[MAX_PATH] = {};
    GetModuleFileNameW(module, path, MAX_PATH);
    configPath = std::wstring(path);
    configPath = configPath.substr(0, configPath.find_last_of(L"\\/")) + L"\\native-window.ini";
    settingsPath = configPath.substr(0, configPath.find_last_of(L"\\/")) + L"\\settings.json";
    if (api->processType & 0x10) {
        api->addNativeAPI(configureTypes, 3, "mac_glass.configure", configure);
        api->addNativeAPI(nullptr, 0, "mac_glass.status", status);
        api->addNativeAPI(nullptr, 0, "mac_glass.settings.load", loadSettings);
        api->addNativeAPI(settingsTypes, 1, "mac_glass.settings.save", saveSettings);
    }
    if ((api->processType & 1) && !started.exchange(true)) {
        if (auto thread = CreateThread(nullptr, 0, worker, nullptr, 0, nullptr)) CloseHandle(thread);
    }
    return 0;
}
BOOL WINAPI DllMain(HINSTANCE handle, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) { module = handle; DisableThreadLibraryCalls(handle); }
    return TRUE;
}
