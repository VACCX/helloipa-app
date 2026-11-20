import Foundation
import UIKit

/// 运行时读取的设备 / 包信息。全部是真实 API 取值，无占位数据。
enum DeviceInfo {

    static var appName: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? "App"
    }

    static var version: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "-"
        return "\(v) (\(b))"
    }

    static var bundleID: String { Bundle.main.bundleIdentifier ?? "-" }

    static var systemVersion: String { "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)" }

    static var model: String { UIDevice.current.model }

    /// 硬件标识，例如 iPhone15,3
    static var machine: String {
        var sysinfo = utsname()
        uname(&sysinfo)
        let mirror = Mirror(reflecting: sysinfo.machine)
        let id = mirror.children.reduce(into: "") { acc, child in
            if let v = child.value as? Int8, v != 0 {
                acc.append(Character(UnicodeScalar(UInt8(v))))
            }
        }
        return id.isEmpty ? "-" : id
    }

    static var screen: String {
        let b = UIScreen.main.bounds.size
        let scale = UIScreen.main.scale
        return "\(Int(b.width))×\(Int(b.height)) @\(String(format: "%.1f", scale))x"
    }

    /// 可用磁盘（含系统容器配额）
    static var diskFree: String {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        guard let attrs = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
              let free = attrs.volumeAvailableCapacityForImportantUsage else { return "-" }
        return ByteCountFormatter.string(fromByteCount: free, countStyle: .file)
    }

    static var memory: String {
        let total = ProcessInfo.processInfo.physicalMemory
        return ByteCountFormatter.string(fromByteCount: Int64(total), countStyle: .memory)
    }

    static var uptime: String {
        let s = Int(ProcessInfo.processInfo.systemUptime)
        return String(format: "%dh %dm", s / 3600, (s % 3600) / 60)
    }

    /// 秒级时间戳，用于剪贴板导出格式
    static var stamp: String {
        let f = ISO8601DateFormatter()
        f.timeZone = .current
        return f.string(from: Date())
    }

    static var allRows: [(String, String)] {
        [
            ("应用名", appName),
            ("版本", version),
            ("Bundle ID", bundleID),
            ("系统", systemVersion),
            ("机型", model),
            ("硬件标识", machine),
            ("屏幕", screen),
            ("可用存储", diskFree),
            ("物理内存", memory),
            ("已开机", uptime),
        ]
    }

    static var plainText: String {
        "stamp: \(stamp)\n" + allRows.map { "\($0.0): \($0.1)" }.joined(separator: "\n")
    }
}
