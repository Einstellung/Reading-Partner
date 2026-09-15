import XCTest

// A UI-test bundle with no app of its own, like GestureDriver beside it: it
// attaches to whatever is already installed by bundle id. This one drives the
// share sheet, which is the only way to reach the app's own
// application:openURL: on a simulator — `simctl openurl` with a file:// URL is
// LaunchServices picking a handler, and PDF and EPUB belong to the built-in
// Preview there (docs/pitfall/294).
//
// The host app is whatever is showing the document; Safari showing a PDF served
// over http is the case scripts/ios-sim.sh documents. Steps are environment
// variables so one built bundle serves every case:
//   HOST_BUNDLE_ID=com.apple.mobilesafari
//   TAPS=0.856,0.0445          normalized window offsets, ";"-separated, or
//                              label=<text> to tap the first element matching
//   SHARE_TO=Reading Partner   the share sheet entry to tap; "-" to stop after
//                              the taps and leave the sheet open
//
// The sheet's cells live in the host's tree on some iOS versions and in
// SpringBoard's on others, so both are searched. A miss prints the host tree,
// which is how you find a control whose label you do not know yet.
final class ShareTests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = true }

  func testShare() throws {
    let env = ProcessInfo.processInfo.environment
    let hostId = env["HOST_BUNDLE_ID"] ?? "com.apple.mobilesafari"
    let target = env["SHARE_TO"] ?? "Reading Partner"
    let taps = env["TAPS"] ?? "0.856,0.0445"
    let app = XCUIApplication(bundleIdentifier: hostId)
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20), "host not foreground")
    Thread.sleep(forTimeInterval: 2)

    let window = app.windows.firstMatch
    for step in taps.split(separator: ";") {
      let parts = step.split(separator: ",")
      if parts.count == 2, let dx = Double(parts[0]), let dy = Double(parts[1]) {
        window.coordinate(withNormalizedOffset: CGVector(dx: dx, dy: dy)).tap()
        Thread.sleep(forTimeInterval: 4)
      } else if let label = step.split(separator: "=").last, step.hasPrefix("label=") {
        let e = app.descendants(matching: .any)
          .matching(NSPredicate(format: "label CONTAINS[c] %@", String(label))).firstMatch
        XCTAssertTrue(e.waitForExistence(timeout: 10), "no element labelled \(label)")
        e.tap()
        Thread.sleep(forTimeInterval: 4)
      }
    }

    if target == "-" { return }
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    for root in [app, springboard] {
      let hit = root.descendants(matching: .any)
        .matching(NSPredicate(format: "label CONTAINS[c] %@", target)).firstMatch
      if hit.exists {
        print("=== FOUND \(target): \(hit.debugDescription) ===")
        hit.tap()
        Thread.sleep(forTimeInterval: 8)
        return
      }
    }
    print("=== TREE (host) ===")
    print(app.debugDescription)
    XCTFail("no \(target) entry")
  }
}
