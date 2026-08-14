import SwiftUI

/**
 * Application entry point.
 *
 * Later this will:
 * - Initialize the native linqa-core library
 * - Set up the encrypted local store
 * - Configure background refresh / push (if used)
 *
 * Currently a pure scaffold.
 */
@main
struct LinqaApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
