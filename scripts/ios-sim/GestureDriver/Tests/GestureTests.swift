import XCTest

// A UI-test bundle with no app of its own: it attaches to whatever is already
// installed by bundle id. idb's HID channel carries one contact at a time, so
// this exists for the gestures that need two — pinch above all, which is what
// docs/pitfall/38 and 41 are about.
//
// Which gesture runs is chosen by an environment variable so one built bundle
// serves every case:
//   GESTURE=pinch-out|pinch-in|tap|press-drag
//   SCALE=2.0  VELOCITY=1.0
//   FROM_X/FROM_Y/TO_X/TO_Y in points from the window's top left, HOLD in
//   seconds (press-drag).
//
// pinch(withScale:velocity:) is the only two-contact gesture XCUITest exposes,
// and it rejects a scale of exactly 1, so a pure two-finger PAN cannot be
// driven from here — the two-finger centroid pan in the reader has to be
// checked another way.
//
// press-drag is here for the opposite reason: it needs one contact, but one
// that stays down while it moves. idb's HID channel can hold a contact still
// or move it, not hold it and then move it, so a long press that extends into
// a drag — the phone reader's way of stretching a highlight (docs/70) — cannot
// be driven by `ios-sim.sh press` or `swipe`.
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
    case "press-drag":
      // Points from the window's top left, turned into the normalized offsets
      // XCUICoordinate wants, so the caller speaks the same coordinates as
      // every other command in ios-sim.sh.
      let size = window.frame.size
      XCTAssertTrue(size.width > 0 && size.height > 0, "the window has no size")
      func point(_ xKey: String, _ yKey: String) -> XCUICoordinate {
        let x = Double(env[xKey] ?? "") ?? 0
        let y = Double(env[yKey] ?? "") ?? 0
        return window.coordinate(
          withNormalizedOffset: CGVector(dx: x / size.width, dy: y / size.height))
      }
      let hold = Double(env["HOLD"] ?? "") ?? 0.9
      point("FROM_X", "FROM_Y").press(forDuration: hold, thenDragTo: point("TO_X", "TO_Y"))
    default:
      XCTFail("unknown GESTURE \(which)")
    }
    // Give the page a moment to settle before the harness reads it back.
    Thread.sleep(forTimeInterval: 1.5)
  }
}
