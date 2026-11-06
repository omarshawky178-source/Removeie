import SwiftUI
import WebKit

@main
struct RemoveieApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct VideoItem: Identifiable, Decodable {
    let id: String
    let url: String
    let title: String
    let image: String
}

struct ScanResponse: Decodable {
    let ok: Bool
    let reason: String?
    let items: [VideoItem]?
}

enum VideoKind: String, Identifiable {
    case like, repost
    var id: String { rawValue }
    var title: String { self == .like ? "Likes" : "Reposts" }
    var icon: String { self == .like ? "heart" : "arrow.2.squarepath" }
}

@MainActor
final class TikTokSession: NSObject, ObservableObject, WKNavigationDelegate {
    let webView: WKWebView
    @Published var username: String?
    @Published var isScanning = false
    @Published var status = ""
    @Published var videos: [VideoItem] = []
    private var navigationCompletion: ((Bool) -> Void)?
    private var scanningTask: Task<Void, Never>?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        if let url = Bundle.main.url(forResource: "assistant", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: URL(string: "https://www.tiktok.com/")!))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        navigationCompletion?(true)
        navigationCompletion = nil
        refreshAccount()
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finishNavigation() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finishNavigation() }
    private func finishNavigation() { navigationCompletion?(false); navigationCompletion = nil }

    func refreshAccount() {
        webView.evaluateJavaScript("window.removeie && window.removeie.account()") { [weak self] value, _ in
            guard let self = self else { return }
            if let name = value as? String, !name.isEmpty { self.username = name }
        }
    }
    func openLogin() {
        if username == nil { webView.load(URLRequest(url: URL(string: "https://www.tiktok.com/login")!)) }
    }
    private func navigate(_ url: URL) async -> Bool {
        await withCheckedContinuation { continuation in
            navigationCompletion = { continuation.resume(returning: $0) }
            webView.load(URLRequest(url: url))
        }
    }
    private func evaluate(_ script: String) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(script) { value, error in
                if let error = error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }
    func scan(_ kind: VideoKind) {
        guard !isScanning, let user = username, let url = URL(string: "https://www.tiktok.com/@\(user)") else {
            status = "سجّل دخولك الأول علشان نقدر نفحص حسابك."
            return
        }
        videos = []
        status = "بنفتح حسابك…"
        isScanning = true
        scanningTask = Task {
            defer { isScanning = false }
            guard await navigate(url) else { status = "تعذر فتح صفحة الحساب. جرّب تاني."; return }
            do {
                try await Task.sleep(nanoseconds: 2_000_000_000)
                let open = try await evaluate("JSON.stringify(window.removeie && window.removeie.openTab('\(kind.rawValue)'))") as? String ?? ""
                guard open.contains("\"ok\":true") else { status = "TikTok ما عرضش تبويب \(kind.title). جرّب تاني بعد تسجيل الدخول."; return }
                try await Task.sleep(nanoseconds: 2_000_000_000)
                var found: [String: VideoItem] = [:]
                var order: [String] = []
                var noChange = 0
                for _ in 0..<60 {
                    if Task.isCancelled { status = "تم إيقاف الفحص. النتائج غير مكتملة."; return }
                    let json = try await evaluate("JSON.stringify(window.removeie && window.removeie.collect('\(kind.rawValue)'))") as? String ?? ""
                    guard let data = json.data(using: .utf8), let result = try? JSONDecoder().decode(ScanResponse.self, from: data), result.ok else {
                        status = "مش قادر أتأكد إن تبويب \(kind.title) مفتوح. الفحص توقف بدون نتائج مؤكدة."
                        return
                    }
                    let before = found.count
                    for video in result.items ?? [] where found[video.id] == nil { found[video.id] = video; order.append(video.id) }
                    videos = order.compactMap { found[$0] }
                    status = "بنبحث… لقينا \(videos.count) فيديو"
                    noChange = found.count == before ? noChange + 1 : 0
                    if noChange >= 4 { break }
                    try await Task.sleep(nanoseconds: 1_200_000_000)
                }
                status = "لقينا \(videos.count) فيديو. النتيجة ممكن تكون غير مكتملة حسب استجابة TikTok."
            } catch { status = "الفحص توقف بسبب مشكلة في تحميل TikTok. جرّب تاني." }
        }
    }
    func stop() { scanningTask?.cancel(); webView.stopLoading(); finishNavigation() }
}

struct BrowserView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct ContentView: View {
    @StateObject private var session = TikTokSession()
    @State private var showLogin = false
    @State private var selected: VideoKind?

    var body: some View {
        NavigationStack {
            ZStack {
                if !showLogin {
                    BrowserView(webView: session.webView)
                        .frame(width: 390, height: 700)
                        .opacity(0.01)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                Color(uiColor: .systemBackground)
                VStack(alignment: .leading, spacing: 28) {
                    HStack {
                        Text("removeie").font(.system(size: 29, weight: .bold, design: .rounded))
                        Spacer()
                        if let username = session.username {
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("Welcome").font(.caption).foregroundStyle(.secondary)
                                Text("@\(username)").font(.subheadline.bold())
                            }
                        } else {
                            Button("Login") { session.openLogin(); showLogin = true }
                                .buttonStyle(.borderedProminent).tint(.black)
                        }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Your activity,").font(.system(size: 31, weight: .bold))
                        Text("all in one place.").font(.system(size: 31, weight: .bold)).foregroundStyle(.secondary)
                        Text("راجع اللايكات والريبوستات بتوعك من مكان واحد.").font(.subheadline).foregroundStyle(.secondary)
                    }
                    VStack(spacing: 0) { activityRow(.like); Divider(); activityRow(.repost) }
                    Spacer()
                    Text("نسخة تجريبية • النتائج تعتمد على TikTok").font(.footnote).foregroundStyle(.secondary)
                }.padding(24)
            }
            .navigationBarHidden(true)
            .navigationDestination(isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })) {
                if let kind = selected { ScanView(session: session, kind: kind) }
            }
            .sheet(isPresented: $showLogin, onDismiss: { session.refreshAccount() }) {
                NavigationStack {
                    BrowserView(webView: session.webView)
                        .navigationTitle("TikTok Login")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { session.refreshAccount(); showLogin = false } } }
                        .task {
                            while !Task.isCancelled {
                                session.refreshAccount()
                                try? await Task.sleep(nanoseconds: 1_000_000_000)
                            }
                        }
                }
            }
        }
    }
    private func activityRow(_ kind: VideoKind) -> some View {
        Button { session.videos = []; session.status = ""; selected = kind } label: {
            HStack(spacing: 15) {
                Image(systemName: kind.icon).font(.title2).frame(width: 35)
                Text(kind.title).font(.headline)
                Spacer()
                Image(systemName: "chevron.right").font(.subheadline).foregroundStyle(.secondary)
            }.foregroundStyle(.primary).padding(.vertical, 20)
        }
    }
}

struct ScanView: View {
    @ObservedObject var session: TikTokSession
    let kind: VideoKind
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(session.videos.count)").font(.system(size: 38, weight: .bold))
                    Text("videos found").foregroundStyle(.secondary)
                }
                Spacer()
                if session.isScanning { Button("Stop") { session.stop() }.buttonStyle(.bordered) }
                else { Button("Scan") { session.scan(kind) }.buttonStyle(.borderedProminent).tint(.black) }
            }
            if !session.status.isEmpty { Text(session.status).font(.footnote).foregroundStyle(.secondary) }
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(session.videos) { video in
                        HStack(spacing: 12) {
                            AsyncImage(url: URL(string: video.image)) { image in image.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.12) }
                                .frame(width: 58, height: 76).clipped().cornerRadius(6)
                            Text(video.title).font(.subheadline).lineLimit(3)
                            Spacer()
                            if let url = URL(string: video.url) { Link(destination: url) { Image(systemName: "arrow.up.right") } }
                        }.padding(.vertical, 10)
                        Divider()
                    }
                }
            }
        }.padding(.horizontal, 24).navigationTitle(kind.title).navigationBarTitleDisplayMode(.inline)
    }
}
