import XCTest
import WebKit

// Exercises the actual injected assistant and Swift-to-WebKit bridge on an
// iOS Simulator. Both TikTok's page and replies below are synthetic fixtures.
@MainActor
final class SimulatorTests: XCTestCase, WKNavigationDelegate {
    private var loaded: XCTestExpectation?
    private var webView: WKWebView!

    private func load(_ fixture: String, reply: String) async throws {
        let sourceURL = try XCTUnwrap(Bundle(for: type(of: self)).url(forResource: "assistant", withExtension: "js"))
        let assistant = try String(contentsOf: sourceURL, encoding: .utf8)
        let setup = """
        window.__testCalls = 0;
        window.__testRequest = null;
        window.fetch = async function(url, options) {
          window.__testCalls++;
          window.__testRequest = { url, method: options.method, credentials: options.credentials };
          return \(reply);
        };
        """
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.addUserScript(WKUserScript(source: setup, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addUserScript(WKUserScript(source: assistant, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        let ready = expectation(description: "fixture loaded")
        loaded = ready
        webView.loadHTMLString("<html><head>\(fixture)</head><body></body></html>", baseURL: URL(string: "https://www.tiktok.com/@me")!)
        await fulfillment(of: [ready], timeout: 15)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded?.fulfill()
        loaded = nil
    }

    private func page() async throws -> [String: Any] {
        let result = try await webView.callAsyncJavaScript(
            "return JSON.stringify(await window.removeie.repostPage(cursor))",
            arguments: ["cursor": "0"], in: nil, contentWorld: .page)
        let json = try XCTUnwrap(result as? String)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }

    func testLivePageDataAndSwiftBridge() async throws {
        let fixture = """
        <script>window.__$UNIVERSAL_DATA$__ = {__DEFAULT_SCOPE__: {'webapp.app-context': {user: {uniqueId: 'me', secUid: 'fixture-id'}}}};</script>
        """
        let reply = """
        {ok:true, json:async()=>({status_code:0,hasMore:false,cursor:0,itemList:[{id:'12345',author:{uniqueId:'creator'},desc:'fixture',video:{cover:''}}]})}
        """
        try await load(fixture, reply: reply)
        let result = try await page()
        XCTAssertEqual(result["ok"] as? Bool, true)
        let item = try XCTUnwrap((result["items"] as? [[String: Any]])?.first)
        XCTAssertEqual(item["id"] as? String, "12345")
        XCTAssertEqual(item["url"] as? String, "https://www.tiktok.com/@creator/video/12345")
        let requestValue = try await webView.evaluateJavaScript("window.__testRequest")
        let request = try XCTUnwrap(requestValue as? [String: Any])
        XCTAssertEqual(request["credentials"] as? String, "same-origin")
        XCTAssertEqual(request["method"] as? String, "GET")
        XCTAssertTrue((request["url"] as? String)?.hasPrefix("/api/repost/item_list/?") == true)
    }

    func testProfileHydrationFallbackAndMismatchedAccount() async throws {
        let fixture = """
        <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"__DEFAULT_SCOPE__":{"webapp.app-context":{"user":{"uniqueId":"me"}},"webapp.user-detail":{"userInfo":{"user":{"uniqueId":"other","secUid":"private-id"}}}}}</script>
        """
        try await load(fixture, reply: "{ok:false,status:500}")
        let result = try await page()
        XCTAssertEqual(result["reason"] as? String, "account-context")
        let context = try XCTUnwrap(result["context"] as? String)
        XCTAssertFalse(context.contains("private-id"))
        XCTAssertFalse(context.contains("other"))
        let calls = try await webView.evaluateJavaScript("window.__testCalls") as? Int
        XCTAssertEqual(calls, 0)
    }

    func testRejectedReplyIsNotShownAsEmptySuccess() async throws {
        let fixture = """
        <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"__DEFAULT_SCOPE__":{"webapp.app-context":{"user":{"uniqueId":"me","secUid":"fixture-id"}}}}</script>
        """
        try await load(fixture, reply: "{ok:false,status:403}")
        let result = try await page()
        XCTAssertEqual(result["ok"] as? Bool, false)
        XCTAssertEqual(result["reason"] as? String, "http-error")
        XCTAssertEqual(result["httpStatus"] as? Int, 403)
    }
}
