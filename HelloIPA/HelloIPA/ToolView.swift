import SwiftUI
import UIKit

/// Base64 / URL 编解码 + 哈希摘要，纯 Foundation 实现。
struct ToolView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case b64encode = "Base64 编码"
        case b64decode = "Base64 解码"
        case urlencode = "URL 编码"
        case urldecode = "URL 解码"
        var id: String { rawValue }
    }

    @State private var mode: Mode = .b64encode
    @State private var input: String = ""
    @State private var output: String = ""
    @State private var errorText: String?

    var body: some View {
        NavigationView {
            VStack(spacing: 12) {
                Picker("模式", selection: $mode) {
                    ForEach(Mode.allCases) { m in Text(m.rawValue).tag(m) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                TextEditor(text: $input)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 120)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.3)))
                    .padding(.horizontal)

                HStack {
                    Button("执行", action: run).buttonStyle(.borderedProminent)
                    Button("交换") { input = output; output = "" }
                    Button("清空") { input = ""; output = ""; errorText = nil }
                    Spacer()
                    Button {
                        UIPasteboard.general.string = output
                    } label: {
                        Label("复制结果", systemImage: "doc.on.doc")
                    }
                    .disabled(output.isEmpty)
                }
                .padding(.horizontal)

                ScrollView {
                    Text(output.isEmpty ? " " : output)
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                }
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .padding(.horizontal)

                if let e = errorText {
                    Text(e).font(.footnote).foregroundColor(.red).padding(.horizontal)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical)
            .navigationTitle("编解码")
        }
        .navigationViewStyle(.stack)
    }

    private func run() {
        errorText = nil
        switch mode {
        case .b64encode:
            output = Data(input.utf8).base64EncodedString()
        case .b64decode:
            if let d = Data(base64Encoded: input.trimmingCharacters(in: .whitespacesAndNewlines)),
               let s = String(data: d, encoding: .utf8) {
                output = s
            } else {
                output = ""
                errorText = "不是合法 Base64，或解码结果不是 UTF-8"
            }
        case .urlencode:
            output = input.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        case .urldecode:
            output = input.removingPercentEncoding ?? ""
            if output.isEmpty { errorText = "含非法百分号转义" }
        }
    }
}
