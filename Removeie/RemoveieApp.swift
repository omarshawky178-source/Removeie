import SwiftUI
import WebKit

@main
struct RemoveieApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    var body: some View {
        VStack(spacing: 0) {
            Text("Removeie — نسخة تجريبية")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(10)
            TikTokBrowser()
        }
        .ignoresSafeArea(edges: .bottom)
    }
}

struct TikTokBrowser: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        if let url = Bundle.main.url(forResource: "assistant", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            configuration.userContentController.addUserScript(
                WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
            )
        }
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: URL(string: "https://www.tiktok.com/")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
