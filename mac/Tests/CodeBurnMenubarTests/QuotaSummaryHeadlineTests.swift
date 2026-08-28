import Foundation
import Testing
@testable import CodeBurnMenubar

@Suite("Quota summary headline")
struct QuotaSummaryHeadlineTests {
    @Test("the most constrained known window drives the glance value")
    func choosesHighestUtilization() {
        let reset = Date(timeIntervalSince1970: 1_800_000_000)
        let weekly = QuotaSummary.Window(label: "Weekly", percent: 0.21, resetsAt: reset)
        let session = QuotaSummary.Window(label: "Current session", percent: 0.73, resetsAt: reset)
        let summary = QuotaSummary(
            providerFilter: .claude,
            connection: .connected,
            primary: weekly,
            details: [session, weekly],
            planLabel: "Max",
            footerLines: []
        )

        #expect(summary.headlineWindow == session)
    }

    @Test("primary remains a fallback when details are absent")
    func fallsBackToPrimary() {
        let primary = QuotaSummary.Window(label: "Weekly", percent: 0.52, resetsAt: nil)
        let summary = QuotaSummary(
            providerFilter: .codex,
            connection: .stale,
            primary: primary,
            details: [],
            planLabel: nil,
            footerLines: []
        )

        #expect(summary.headlineWindow == primary)
    }

    @Test("unknown data remains unknown instead of becoming zero percent")
    func unknownRemainsNil() {
        let summary = QuotaSummary(
            providerFilter: .codex,
            connection: .disconnected,
            primary: nil,
            details: [],
            planLabel: nil,
            footerLines: []
        )

        #expect(summary.headlineWindow == nil)
    }
}
