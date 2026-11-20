import SwiftUI
import UIKit

struct ContentView: View {
    var body: some View {
        TabView {
            DeviceView()
                .tabItem { Label("设备", systemImage: "iphone") }
            ToolView()
                .tabItem { Label("工具", systemImage: "wand.and.stars") }
        }
    }
}

struct DeviceView: View {
    @State private var copied = false

    var body: some View {
        NavigationView {
            List {
                ForEach(DeviceInfo.allRows, id: \.0) { row in
                    HStack(alignment: .firstTextBaseline) {
                        Text(row.0)
                            .foregroundColor(.secondary)
                        Spacer()
                        Text(row.1)
                            .font(.system(.body, design: .monospaced))
                            .multilineTextAlignment(.trailing)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(DeviceInfo.appName)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        UIPasteboard.general.string = DeviceInfo.plainText
                        copied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { copied = false }
                    } label: {
                        Label(copied ? "已复制" : "复制", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                }
            }
        }
        .navigationViewStyle(.stack)
    }
}
