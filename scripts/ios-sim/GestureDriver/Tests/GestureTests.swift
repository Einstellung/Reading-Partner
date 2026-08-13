import XCTest

// A UI-test bundle with no app of its own: it attaches to whatever is already
// installed by bundle id. idb's HID channel carries one contact at a time, so
// this exists for the gestures that need two — pinch above all, which is what
// docs/pitfall/38 and 41 are about.
//
// Which gesture runs is chosen by an environment variable so one built bundle
// serves every case:
//   GESTURE=pinch-out|pinch-in|tap
//   SCALE=2.0  VELOCITY=1.0
//
// pinch(withScale:velocity:) is the only two-contact gesture XCUITest exposes,
// and it rejects a scale of exactly 1, so a pure two-finger PAN cannot be
// driven from here — the two-finger centroid pan in the reader has to be
// checked another way.
final class GestureTests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    let bundleId = ProcessInfo.processInfo.environment["TARGET_BUNDLE_ID"]
      ?? "com.xinyuan.readingpartner"
    app = XCUIApplication(bundleIdentifier: bundleId)
    app.activate()
    XCTAssertEqual(app.state, .runningForeground, "the app under test is not in the foreground")
  }

  func testGesture() throws {
    let env = ProcessInfo.processInfo.environment
    let which = env["GESTURE"] ?? "pinch-out"
    let scale = Double(env["SCALE"] ?? "") ?? 2.0
    let velocity = Double(env["VELOCITY"] ?? "") ?? 1.0
    let window = app.windows.firstMatch
    XCTAssertTrue(window.waitForExistence(timeout: 10), "no window")

    switch which {
    case "pinch-out":
      window.pinch(withScale: CGFloat(scale), velocity: CGFloat(velocity))
    case "pinch-in":
      window.pinch(withScale: CGFloat(scale), velocity: CGFloat(-abs(velocity)))
    case "tap":
      window.tap()
    default:
      XCTFail("unknown GESTURE \(which)")
    }
    // Give the page a moment to settle before the harness reads it back.
    Thread.sleep(forTimeInterval: 1.5)
  }
}
