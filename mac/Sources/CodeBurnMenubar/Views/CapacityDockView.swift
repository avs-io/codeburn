import AppKit
import Observation
import SwiftUI

enum CapacityDockMetrics {
    private static let baseRailWidth: CGFloat = 88
    private static let baseEdgeFlareWidth: CGFloat = 22
    private static let baseEdgeShoulderDepth: CGFloat = 44
    private static let baseRowHeight: CGFloat = 84
    private static let baseRowSpacing: CGFloat = 12
    private static let baseRailTopPadding: CGFloat = 18
    private static let baseRailBottomPadding: CGFloat = 18
    private static let baseRingSize: CGFloat = 52
    private static let baseRingStrokeWidth: CGFloat = 4
    private static let baseRingLabelSpacing: CGFloat = 6
    private static let baseProviderIconSize: CGFloat = 26
    private static let basePercentageTextSize: CGFloat = 17
    private static let baseDetailWidth: CGFloat = 350

    static func railWidth(scale: CGFloat) -> CGFloat { baseRailWidth * scale }
    static func horizontalRailWidth(scale: CGFloat) -> CGFloat { baseRailWidth * scale }
    static func edgeFlareWidth(scale: CGFloat) -> CGFloat { baseEdgeFlareWidth * scale }
    static func edgeShoulderDepth(scale: CGFloat) -> CGFloat { baseEdgeShoulderDepth * scale }
    static func rowHeight(scale: CGFloat) -> CGFloat { baseRowHeight * scale }
    static func rowSpacing(scale: CGFloat) -> CGFloat { baseRowSpacing * scale }
    static func railTopPadding(scale: CGFloat) -> CGFloat { baseRailTopPadding * scale }
    static func railBottomPadding(scale: CGFloat) -> CGFloat { baseRailBottomPadding * scale }
    static func ringSize(scale: CGFloat) -> CGFloat { baseRingSize * scale }
    static func ringStrokeWidth(scale: CGFloat) -> CGFloat { baseRingStrokeWidth * scale }
    static func ringLabelSpacing(scale: CGFloat) -> CGFloat { baseRingLabelSpacing * scale }
    static func providerIconSize(scale: CGFloat) -> CGFloat { baseProviderIconSize * scale }
    static func percentageTextSize(scale: CGFloat) -> CGFloat { basePercentageTextSize * scale }
    static func detailWidth(scale: CGFloat) -> CGFloat { baseDetailWidth * scale }

    static func railHeight(providerCount: Int, scale: CGFloat) -> CGFloat {
        let count = max(providerCount, 1)
        return railTopPadding(scale: scale)
            + CGFloat(count) * rowHeight(scale: scale)
            + CGFloat(max(0, count - 1)) * rowSpacing(scale: scale)
            + railBottomPadding(scale: scale)
    }

    static func detailHeight(quota: QuotaSummary?, scale: CGFloat) -> CGFloat {
        guard let quota else { return 186 * scale }
        let rows = min(max(quota.details.count, quota.primary == nil ? 0 : 1), 5)
        let visibleFooter = CapacityDockQuotaPresentation.visibleFooterLines(
            quota.footerLines,
            connection: quota.connection
        )
        let footer = visibleFooter.isEmpty ? 0 : min(visibleFooter.count, 2) * 18 + 10
        let actionExtra: CGFloat = CapacityDockConnectionAction.resolve(quota: quota) == nil ? 0 : 38
        let connectionExtra: CGFloat = switch quota.connection {
        case .terminalFailure: 90
        case .disconnected: 18
        case .loading, .stale, .transientFailure: 16
        case .connected: 0
        }
        let base = min(
            470,
            max(176, 116 + CGFloat(rows) * 60 + CGFloat(footer) + actionExtra + connectionExtra)
        )
        return base * scale
    }
}

@MainActor
@Observable
final class CapacityDockViewModel {
    var preferences: CapacityDockPreferences.Snapshot
    var interaction = CapacityDockInteractionState()
    var hoveredProvider: CapacityDockProvider?
    var detailHeight: CGFloat = 164
    var isRailPresentationExpanded = false
    var railPresentationProgress: CGFloat = 0
    var dockedEdge: CapacityDockEdge?
    var attachmentEdge: CapacityDockEdge
    var attachmentProgress: CGFloat
    var detailTailEdge: CapacityDockEdge = .right
    var detailTailPosition: CGFloat = 0.5
    var expansionAnchor: CapacityDockExpansionAnchor = .start

    init(preferences: CapacityDockPreferences.Snapshot) {
        self.preferences = preferences
        self.dockedEdge = preferences.dockedEdge
        self.attachmentEdge = preferences.attachmentEdge
        self.attachmentProgress = preferences.dockedEdge == nil ? 0 : 1
    }

    var displayedProviders: [CapacityDockProvider] {
        guard isRailPresentationExpanded else { return [preferences.preferredProvider] }
        let preferred = preferences.preferredProvider
        let providers = [preferred] + preferences.selectedProviders.filter { $0 != preferred }
        return expansionAnchor == .start ? providers : providers.reversed()
    }

    var restingBodyLength: CGFloat {
        CapacityDockMetrics.railHeight(providerCount: 1, scale: scale)
    }
    var expandedBodyLength: CGFloat {
        CapacityDockMetrics.railHeight(
            providerCount: preferences.selectedProviders.count,
            scale: scale
        )
    }
    var targetBodyLength: CGFloat {
        interaction.isExpanded ? expandedBodyLength : restingBodyLength
    }
    var bodyLength: CGFloat {
        restingBodyLength
            + (expandedBodyLength - restingBodyLength)
            * min(max(railPresentationProgress, 0), 1)
    }

    var scale: CGFloat { CGFloat(preferences.scale) }
    var detailScale: CGFloat { max(scale, 0.9) }
    var railWidth: CGFloat {
        isVertical
            ? CapacityDockMetrics.railWidth(scale: scale)
            : CapacityDockMetrics.horizontalRailWidth(scale: scale)
    }
    var edgeFlareWidth: CGFloat { CapacityDockMetrics.edgeFlareWidth(scale: scale) }
    var isDocked: Bool { dockedEdge != nil }
    var isVertical: Bool { attachmentEdge.isVertical }
    var bodySize: CGSize {
        isVertical
            ? CGSize(width: railWidth, height: bodyLength)
            : CGSize(width: bodyLength, height: railWidth)
    }
    var panelSize: CGSize {
        panelSize(forAttachmentProgress: attachmentProgress)
    }
    func panelSize(forAttachmentProgress progress: CGFloat) -> CGSize {
        panelSize(bodyLength: bodyLength, attachmentProgress: progress)
    }
    func targetPanelSize(forAttachmentProgress progress: CGFloat) -> CGSize {
        panelSize(bodyLength: targetBodyLength, attachmentProgress: progress)
    }
    private func panelSize(bodyLength: CGFloat, attachmentProgress progress: CGFloat) -> CGSize {
        return isVertical
            ? CGSize(width: railWidth, height: bodyLength)
            : CGSize(width: bodyLength, height: railWidth)
    }
    var rowHeight: CGFloat { CapacityDockMetrics.rowHeight(scale: scale) }
    var rowSpacing: CGFloat { CapacityDockMetrics.rowSpacing(scale: scale) }
    var railTopPadding: CGFloat { CapacityDockMetrics.railTopPadding(scale: scale) }
    var railBottomPadding: CGFloat { CapacityDockMetrics.railBottomPadding(scale: scale) }
    var detailWidth: CGFloat { CapacityDockMetrics.detailWidth(scale: detailScale) }

    func presentationOpacity(for provider: CapacityDockProvider) -> CGFloat {
        provider == preferences.preferredProvider ? 1 : railPresentationProgress
    }
}

struct CapacityDockView: View {
    let model: CapacityDockViewModel
    let quota: (CapacityDockProvider) -> QuotaSummary?
    let onRailHover: (Bool) -> Void
    let onProviderHover: (CapacityDockProvider, Bool) -> Void
    let onProviderClick: (CapacityDockProvider) -> Void
    let onHide: () -> Void
    let onDock: (CapacityDockEdge) -> Void
    let onDragChanged: (CGPoint, CGSize) -> Void
    let onDragEnded: () -> Void

    var body: some View {
        let railShape = CapacityDockRailShape(
            bodyWidth: model.railWidth,
            bodyLength: model.bodyLength,
            shoulderDepth: CapacityDockMetrics.edgeShoulderDepth(scale: model.scale),
            attachmentProgress: model.attachmentProgress,
            edge: model.attachmentEdge
        )
        let providerLayout = model.isVertical
            ? AnyLayout(VStackLayout(spacing: model.rowSpacing))
            : AnyLayout(HStackLayout(spacing: model.rowSpacing))
        providerLayout {
            ForEach(Array(model.displayedProviders.enumerated()), id: \.element.id) { index, provider in
                CapacityDockProviderRow(
                    provider: provider,
                    quota: quota(provider),
                    scale: model.scale,
                    gaugeShape: model.preferences.gaugeShape,
                    onHover: { onProviderHover(provider, $0) },
                    onClick: { onProviderClick(provider) }
                )
                .frame(
                    width: model.isVertical ? model.railWidth : model.rowHeight,
                    height: model.isVertical ? model.rowHeight : model.railWidth
                )
                .opacity(model.presentationOpacity(for: provider))
                .offset(
                    x: model.isVertical || provider == model.preferences.preferredProvider
                        ? 0
                        : -8 * model.scale * (1 - model.railPresentationProgress),
                    y: !model.isVertical || provider == model.preferences.preferredProvider
                        ? 0
                        : -8 * model.scale * (1 - model.railPresentationProgress)
                )
            }
        }
        .padding(.top, model.isVertical ? model.railTopPadding : 0)
        .padding(.bottom, model.isVertical ? model.railBottomPadding : 0)
        .padding(.leading, model.isVertical ? 0 : model.railTopPadding)
        .padding(.trailing, model.isVertical ? 0 : model.railBottomPadding)
        // Keep the preferred row pinned to the reveal origin. Without an
        // explicit axis alignment, SwiftUI centers the already-expanded stack
        // inside the interpolating frame and makes the first ring look as if it
        // is being redrawn from the middle with the incoming rows.
        .frame(
            width: model.bodySize.width,
            height: model.bodySize.height,
            alignment: revealAlignment
        )
        .frame(
            width: model.panelSize.width,
            height: model.panelSize.height,
            alignment: contentAlignment
        )
        .background(CapacityDockSurface(shape: railShape, theme: model.preferences.theme))
        .clipShape(railShape)
        .overlay {
            if model.preferences.theme == .graphite {
                railShape
                    .stroke(
                        LinearGradient(
                            stops: [
                                .init(color: .white.opacity(0.05), location: 0),
                                .init(color: .white.opacity(0.09), location: 0.55),
                                .init(color: .white.opacity(0.14), location: 0.86),
                                .init(color: .white.opacity(0.08), location: 1),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: max(0.6, model.scale * 0.8)
                    )
            }
        }
        .clipShape(railShape)
        .contentShape(railShape)
        .onHover(perform: onRailHover)
        .contextMenu {
            Menu("Dock to Edge") {
                Button("Left") { onDock(.left) }
                Button("Right") { onDock(.right) }
                Button("Top") { onDock(.top) }
                Button("Bottom") { onDock(.bottom) }
            }
            Button("Hide Capacity Dock", action: onHide)
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 3, coordinateSpace: .global)
                .onChanged { onDragChanged(NSEvent.mouseLocation, $0.translation) }
                .onEnded { _ in onDragEnded() }
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Capacity Dock")
    }

    private var contentAlignment: Alignment {
        switch model.attachmentEdge {
        case .left: .trailing
        case .right: .leading
        case .top: .bottom
        case .bottom: .top
        }
    }

    private var revealAlignment: Alignment {
        if model.isVertical {
            return model.expansionAnchor == .start ? .top : .bottom
        }
        return model.expansionAnchor == .start ? .leading : .trailing
    }
}

private struct CapacityDockProviderRow: View {
    let provider: CapacityDockProvider
    let quota: QuotaSummary?
    let scale: CGFloat
    let gaugeShape: CapacityDockGaugeShape
    let onHover: (Bool) -> Void
    let onClick: () -> Void

    private var headline: QuotaSummary.Window? { quota?.headlineWindow }
    private var percent: Double? { headline?.percent }

    var body: some View {
        Button(action: onClick) {
            VStack(spacing: CapacityDockMetrics.ringLabelSpacing(scale: scale)) {
                ZStack {
                    CapacityDockUsageRing(
                        progress: percent,
                        color: provider.ringColor,
                        scale: scale,
                        gaugeShape: gaugeShape
                    )

                    if let image = ProviderIconCache.image(named: provider.iconName) {
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFit()
                            .foregroundStyle(.white)
                            .frame(
                                width: CapacityDockMetrics.providerIconSize(scale: scale),
                                height: CapacityDockMetrics.providerIconSize(scale: scale)
                            )
                    } else {
                        Image(systemName: "circle.dotted")
                            .font(.system(size: 21 * scale, weight: .medium))
                            .foregroundStyle(.white)
                    }

                    if case .terminalFailure = quota?.connection {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 12 * scale, weight: .bold))
                            .foregroundStyle(.red)
                            .background(Circle().fill(.black))
                            .offset(x: 19 * scale, y: -19 * scale)
                    }
                }
                .frame(
                    width: CapacityDockMetrics.ringSize(scale: scale),
                    height: CapacityDockMetrics.ringSize(scale: scale)
                )

                Text(headline?.percentLabel ?? "--")
                    .font(.system(
                        size: CapacityDockMetrics.percentageTextSize(scale: scale),
                        weight: .medium
                    ))
                    .monospacedDigit()
                    .foregroundStyle(headlinePercentColor)
                    .contentTransition(.numericText())
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover(perform: onHover)
        .accessibilityLabel("\(provider.displayName) usage")
        .accessibilityValue(headline?.percentLabel ?? "Unknown")
        .accessibilityHint("Click to keep Capacity Dock expanded")
    }

    private var headlinePercentColor: Color {
        guard let percent else { return .white.opacity(0.72) }
        switch QuotaSummary.severity(for: percent) {
        case .normal: return .white
        case .warning: return .yellow
        case .critical: return .orange
        case .danger: return .red
        }
    }
}

private struct CapacityDockUsageRing: View {
    let progress: Double?
    let color: Color
    let scale: CGFloat
    let gaugeShape: CapacityDockGaugeShape

    private var strokeWidth: CGFloat {
        CapacityDockMetrics.ringStrokeWidth(scale: scale)
    }

    var body: some View {
        ZStack {
            // A recessed track makes the progress read as light filling a
            // physical channel instead of a flat vector stroke.
            CapacityDockGaugePath(kind: gaugeShape)
                .stroke(Color.black.opacity(0.74), lineWidth: strokeWidth + 2 * scale)
            CapacityDockGaugePath(kind: gaugeShape)
                .stroke(
                    LinearGradient(
                        colors: [.white.opacity(0.16), .white.opacity(0.07), .white.opacity(0.12)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: strokeWidth + 0.6 * scale
                )

            if let progress {
                let amount = min(max(progress, 0), 1)
                CapacityDockGaugePath(kind: gaugeShape)
                    .trim(from: 0, to: amount)
                    .stroke(
                        color.opacity(0.40),
                        style: StrokeStyle(lineWidth: strokeWidth + 2 * scale, lineCap: .round)
                    )
                    .blur(radius: 2 * scale)
                    .rotationEffect(.degrees(-90))
                CapacityDockGaugePath(kind: gaugeShape)
                    .trim(from: 0, to: amount)
                    .stroke(
                        LinearGradient(
                            colors: [color.opacity(0.78), color, color.opacity(0.86)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                CapacityDockGaugePath(kind: gaugeShape)
                    .trim(from: 0, to: amount)
                    .stroke(
                        LinearGradient(
                            colors: [.white.opacity(0.52), .white.opacity(0.10), .clear],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        style: StrokeStyle(lineWidth: max(0.8, 1.15 * scale), lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
            } else {
                CapacityDockGaugePath(kind: gaugeShape)
                    .stroke(
                        Color.white.opacity(0.24),
                        style: StrokeStyle(
                            lineWidth: 2 * scale,
                            dash: [3 * scale, 4 * scale]
                        )
                    )
            }
        }
    }
}

struct CapacityDockGaugePath: Shape {
    let kind: CapacityDockGaugeShape

    func path(in rect: CGRect) -> Path {
        switch kind {
        case .circle:
            Path(ellipseIn: rect)
        case .squircle:
            RoundedRectangle(
                cornerRadius: min(rect.width, rect.height) * 0.30,
                style: .continuous
            )
            .path(in: rect)
        }
    }
}

enum CapacityDockQuotaPresentation {
    static func displayLabel(_ label: String) -> String {
        label
            .replacingOccurrences(of: "Claude and GPT models", with: "Claude + GPT", options: .caseInsensitive)
            .replacingOccurrences(of: "Gemini Models", with: "Gemini", options: .caseInsensitive)
            .replacingOccurrences(of: "Five-hour", with: "5-hour", options: .caseInsensitive)
    }

    static func visibleFooterLines(
        _ lines: [String],
        connection: QuotaSummary.Connection
    ) -> [String] {
        guard case let .terminalFailure(reason) = connection,
              let reason,
              !reason.isEmpty else { return lines }
        let normalizedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        return lines.filter {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
                .localizedCaseInsensitiveCompare(normalizedReason) != .orderedSame
        }
    }
}

struct CapacityDockDetailView: View {
    let model: CapacityDockViewModel
    let quota: (CapacityDockProvider) -> QuotaSummary?
    let onHover: (Bool) -> Void
    let onConnect: (CapacityDockProvider) -> Void

    var body: some View {
        let bubbleShape = CapacityDockBubbleShape(
            tailEdge: model.detailTailEdge,
            tailPosition: model.detailTailPosition
        )
        Group {
            if let provider = model.hoveredProvider {
                detail(for: provider, quota: quota(provider))
            }
        }
        .padding(detailInsets)
        .frame(
            width: model.detailWidth,
            height: model.detailHeight,
            alignment: .topLeading
        )
        .background(CapacityDockSurface(shape: bubbleShape, theme: model.preferences.theme))
        .overlay {
            if model.preferences.theme == .graphite {
                bubbleShape
                    .stroke(Color.white.opacity(0.09), lineWidth: max(0.5, model.detailScale))
            }
        }
        .contentShape(bubbleShape)
        .onHover(perform: onHover)
        .accessibilityElement(children: .contain)
    }

    private var detailInsets: EdgeInsets {
        let horizontal = 24 * model.detailScale
        let vertical = 22 * model.detailScale
        let tailAllowance = 18 * model.detailScale
        return EdgeInsets(
            top: vertical + (model.detailTailEdge == .top ? tailAllowance : 0),
            leading: horizontal + (model.detailTailEdge == .left ? tailAllowance : 0),
            bottom: vertical + (model.detailTailEdge == .bottom ? tailAllowance : 0),
            trailing: horizontal + (model.detailTailEdge == .right ? tailAllowance : 0)
        )
    }

    @ViewBuilder
    private func detail(for provider: CapacityDockProvider, quota: QuotaSummary?) -> some View {
        VStack(alignment: .leading, spacing: 14 * model.detailScale) {
            HStack(spacing: 8 * model.detailScale) {
                if let image = ProviderIconCache.image(named: provider.iconName) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFit()
                        .foregroundStyle(.white)
                        .frame(width: 24 * model.detailScale, height: 24 * model.detailScale)
                }
                Text("\(provider.displayName) Usage")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer(minLength: 8)
                if let plan = quota?.planLabel, !plan.isEmpty {
                    Text(plan)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.white.opacity(0.62))
                        .lineLimit(1)
                }
            }

            if let quota {
                connectionLabel(quota.connection, provider: provider)
                if quota.details.isEmpty, let primary = quota.primary {
                    CapacityDockQuotaRow(
                        window: primary,
                        color: provider.ringColor,
                        scale: model.detailScale
                    )
                } else {
                    ForEach(Array(quota.details.prefix(5).enumerated()), id: \.offset) { _, window in
                        CapacityDockQuotaRow(
                            window: window,
                            color: provider.ringColor,
                            scale: model.detailScale
                        )
                    }
                }
                let footerLines = CapacityDockQuotaPresentation.visibleFooterLines(
                    quota.footerLines,
                    connection: quota.connection
                )
                if !footerLines.isEmpty {
                    Divider().overlay(Color.white.opacity(0.12))
                    ForEach(Array(footerLines.prefix(2).enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 10))
                            .foregroundStyle(.white.opacity(0.58))
                    }
                }
            } else {
                Text(ProviderConnectionGuidance.dockInstruction(for: provider))
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.62))
                    .fixedSize(horizontal: false, vertical: true)
            }

            if provider.catalogEntry.hasLiveCodeBurnQuotaAdapter,
               let action = CapacityDockConnectionAction.resolve(quota: quota) {
                let title = action.title(for: provider)
                Button(title) { onConnect(provider) }
                    .buttonStyle(.borderedProminent)
                    .tint(provider.ringColor)
                    .controlSize(.small)
                    .accessibilityLabel("\(title) \(provider.displayName)")
            }
        }
    }

    @ViewBuilder
    private func connectionLabel(
        _ connection: QuotaSummary.Connection,
        provider: CapacityDockProvider
    ) -> some View {
        switch connection {
        case .connected:
            EmptyView()
        case .loading:
            Text("Refreshing…")
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.52))
        case .stale:
            Text("Last known usage · refreshing")
                .font(.system(size: 10))
                .foregroundStyle(.yellow.opacity(0.82))
        case .transientFailure:
            Text("Last known usage · retrying")
                .font(.system(size: 10))
                .foregroundStyle(.orange.opacity(0.86))
        case .disconnected:
            Text("Not connected")
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.6))
        case .terminalFailure(let reason):
            VStack(alignment: .leading, spacing: 3 * model.detailScale) {
                Text("Reconnect required")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.red)
                if let reason, !reason.isEmpty {
                    Text(reason)
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(2)
                }
                Text(ProviderConnectionGuidance.dockInstruction(for: provider))
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct CapacityDockQuotaRow: View {
    let window: QuotaSummary.Window
    let color: Color
    let scale: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 6 * scale) {
            HStack(alignment: .firstTextBaseline, spacing: 8 * scale) {
                Text(CapacityDockQuotaPresentation.displayLabel(window.label))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.82))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Text(window.percentLabel)
                    .font(.system(size: 12, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.white)
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.14))
                    Capsule()
                        .fill(progressColor)
                        .frame(width: max(2, geometry.size.width * min(max(window.percent, 0), 1)))
                }
            }
            .frame(height: 6 * scale)
            if !window.resetsInLabel.isEmpty {
                Text("Resets in \(window.resetsInLabel)")
                    .font(.system(size: 10))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.5))
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    private var progressColor: Color {
        switch QuotaSummary.severity(for: window.percent) {
        case .normal: return color
        case .warning: return .yellow
        case .critical: return .orange
        case .danger: return .red
        }
    }
}

private struct CapacityDockSurface<S: Shape>: View {
    let shape: S
    let theme: CapacityDockTheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @ViewBuilder
    var body: some View {
        if theme == .liquidGlass, !reduceTransparency {
            if #available(macOS 26.0, *) {
                CapacityDockNativeGlassSurface(shape: shape)
            } else {
                shape
                    .fill(.ultraThinMaterial)
                    .overlay(shape.fill(Color.black.opacity(0.16)))
            }
        } else {
            ZStack {
                shape.fill(
                    LinearGradient(
                        stops: [
                            .init(color: Color(red: 0.075, green: 0.078, blue: 0.085), location: 0),
                            .init(color: Color(red: 0.034, green: 0.035, blue: 0.040), location: 0.46),
                            .init(color: Color(red: 0.012, green: 0.013, blue: 0.016), location: 1),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                shape.fill(
                    RadialGradient(
                        colors: [.white.opacity(0.055), .clear],
                        center: .topLeading,
                        startRadius: 0,
                        endRadius: 180
                    )
                )
            }
        }
    }
}

@available(macOS 26.0, *)
private struct CapacityDockNativeGlassSurface<S: Shape>: View {
    let shape: S

    var body: some View {
        Color.clear
            .glassEffect(.regular.interactive(), in: shape)
    }
}

struct CapacityDockRailShape: Shape {
    var bodyWidth: CGFloat
    var bodyLength: CGFloat? = nil
    var shoulderDepth: CGFloat = 34
    var attachmentProgress: CGFloat
    var edge: CapacityDockEdge

    var animatableData: CGFloat {
        get { attachmentProgress }
        set { attachmentProgress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let canonicalRect = CGRect(
            x: 0,
            y: 0,
            width: edge.isVertical ? rect.width : rect.height,
            height: edge.isVertical ? rect.height : rect.width
        )
        let canonical = rightFlarePath(in: canonicalRect)
        let transform: CGAffineTransform
        switch edge {
        case .right:
            transform = CGAffineTransform(translationX: rect.minX, y: rect.minY)
        case .left:
            transform = CGAffineTransform(
                a: -1,
                b: 0,
                c: 0,
                d: 1,
                tx: canonicalRect.width + rect.minX,
                ty: rect.minY
            )
        case .bottom:
            transform = CGAffineTransform(
                a: 0,
                b: 1,
                c: 1,
                d: 0,
                tx: rect.minX,
                ty: rect.minY
            )
        case .top:
            transform = CGAffineTransform(
                a: 0,
                b: -1,
                c: 1,
                d: 0,
                tx: rect.minX,
                ty: canonicalRect.width + rect.minY
            )
        }
        return canonical.applying(transform)
    }

    private func rightFlarePath(in rect: CGRect) -> Path {
        let progress = min(max(attachmentProgress, 0), 1)
        let radius = min(28, bodyWidth * 0.32, rect.height * 0.25)
        let eased = progress * progress * (3 - 2 * progress)
        let attachedRadius = radius * (1 - eased)
        // Wetting the screen edge pulls the rail's top and bottom surfaces
        // inward on the free side while the contact chord opens toward both
        // panel corners. The resulting shoulders flare *into* the touched
        // edge, rather than adding horns outside the panel. Every point and
        // control point stays within `rect`, so attachment cannot change the
        // panel length or reveal a screen-coloured sliver at scaled sizes.
        let shoulderInset = min(
            radius * 0.5,
            shoulderDepth * 0.34,
            rect.height * 0.12
        ) * eased
        let topStart = CGPoint(
            x: rect.minX + radius,
            y: rect.minY + shoulderInset
        )
        let topEnd = CGPoint(
            x: rect.maxX - attachedRadius,
            y: rect.minY
        )
        let topRun = max(0, topEnd.x - topStart.x)
        let shoulderRun = min(shoulderDepth, topRun)
        let topCurveStart = CGPoint(
            x: topEnd.x - shoulderRun,
            y: topStart.y
        )
        let bottomStart = CGPoint(
            x: rect.maxX - attachedRadius,
            y: rect.maxY
        )
        let bottomEnd = CGPoint(
            x: rect.minX + radius,
            y: rect.maxY - shoulderInset
        )

        var path = Path()
        path.move(to: topStart)
        path.addLine(to: topCurveStart)
        path.addCurve(
            to: topEnd,
            control1: CGPoint(
                x: topCurveStart.x + shoulderRun * 0.38,
                y: topCurveStart.y
            ),
            control2: CGPoint(
                x: topEnd.x - shoulderRun * 0.22,
                y: topEnd.y
            )
        )
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY + attachedRadius),
            control: CGPoint(x: rect.maxX, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - attachedRadius))
        path.addQuadCurve(
            to: bottomStart,
            control: CGPoint(x: rect.maxX, y: rect.maxY)
        )
        path.addCurve(
            to: CGPoint(x: topCurveStart.x, y: bottomEnd.y),
            control1: CGPoint(
                x: bottomStart.x - shoulderRun * 0.22,
                y: bottomStart.y
            ),
            control2: CGPoint(
                x: topCurveStart.x + shoulderRun * 0.38,
                y: bottomEnd.y
            )
        )
        path.addLine(to: bottomEnd)
        path.addQuadCurve(
            to: CGPoint(x: rect.minX, y: bottomEnd.y - radius),
            control: CGPoint(x: rect.minX, y: bottomEnd.y)
        )
        path.addLine(to: CGPoint(x: rect.minX, y: topStart.y + radius))
        path.addQuadCurve(
            to: topStart,
            control: CGPoint(x: rect.minX, y: topStart.y)
        )
        path.closeSubpath()
        return path
    }
}

struct CapacityDockBubbleShape: Shape {
    let tailEdge: CapacityDockEdge
    var tailPosition: CGFloat = 0.5

    func path(in rect: CGRect) -> Path {
        let canonicalRect = CGRect(
            x: 0,
            y: 0,
            width: tailEdge.isVertical ? rect.width : rect.height,
            height: tailEdge.isVertical ? rect.height : rect.width
        )
        let canonical = rightTailPath(in: canonicalRect)
        let transform: CGAffineTransform
        switch tailEdge {
        case .right:
            transform = CGAffineTransform(translationX: rect.minX, y: rect.minY)
        case .left:
            transform = CGAffineTransform(
                a: -1,
                b: 0,
                c: 0,
                d: 1,
                tx: canonicalRect.width + rect.minX,
                ty: rect.minY
            )
        case .bottom:
            transform = CGAffineTransform(
                a: 0,
                b: 1,
                c: 1,
                d: 0,
                tx: rect.minX,
                ty: rect.minY
            )
        case .top:
            transform = CGAffineTransform(
                a: 0,
                b: -1,
                c: 1,
                d: 0,
                tx: rect.minX,
                ty: canonicalRect.width + rect.minY
            )
        }
        return canonical.applying(transform)
    }

    private func rightTailPath(in rect: CGRect) -> Path {
        var path = Path()
        let tailWidth = min(22, max(14, rect.width * 0.055))
        let bodyRight = rect.maxX - tailWidth
        let radius = min(20, rect.height * 0.18)
        let midY = rect.minY + rect.height * min(max(tailPosition, 0.18), 0.82)
        let neckHalfHeight = min(32, rect.height * 0.19)

        path.move(to: CGPoint(x: radius, y: rect.minY))
        path.addLine(to: CGPoint(x: bodyRight - radius, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: bodyRight, y: rect.minY + radius),
            control: CGPoint(x: bodyRight, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: bodyRight, y: midY - neckHalfHeight))
        path.addCurve(
            to: CGPoint(x: rect.maxX, y: midY),
            control1: CGPoint(x: bodyRight, y: midY - neckHalfHeight * 0.55),
            control2: CGPoint(x: rect.maxX, y: midY - tailWidth * 0.42)
        )
        path.addCurve(
            to: CGPoint(x: bodyRight, y: midY + neckHalfHeight),
            control1: CGPoint(x: rect.maxX, y: midY + tailWidth * 0.42),
            control2: CGPoint(x: bodyRight, y: midY + neckHalfHeight * 0.55)
        )
        path.addLine(to: CGPoint(x: bodyRight, y: rect.maxY - radius))
        path.addQuadCurve(
            to: CGPoint(x: bodyRight - radius, y: rect.maxY),
            control: CGPoint(x: bodyRight, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: radius, y: rect.maxY))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX, y: rect.maxY - radius),
            control: CGPoint(x: rect.minX, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addQuadCurve(
            to: CGPoint(x: radius, y: rect.minY),
            control: CGPoint(x: rect.minX, y: rect.minY)
        )
        path.closeSubpath()
        return path
    }
}

private extension CapacityDockProvider {
    var ringColor: Color {
        switch self {
        case .claude: return Color(red: 0.98, green: 0.31, blue: 0.08)
        case .codex: return Color(red: 0.12, green: 0.87, blue: 0.55)
        case .gemini: return Color(red: 0.28, green: 0.55, blue: 0.98)
        case .copilot: return Color(red: 0.58, green: 0.48, blue: 0.96)
        case .kimiCode: return Color(red: 0.90, green: 0.94, blue: 0.08)
        case .antigravity: return Color(red: 1.0, green: 0.48, blue: 0.27)
        default:
            // Stable CodeBurn-owned accents keep generated provider sigils
            // recognizable without importing a branding registry.
            let seed = rawValue.utf8.reduce(UInt64(2_166_136_261)) { value, byte in
                (value ^ UInt64(byte)) &* 16_777_619
            }
            return Color(
                hue: Double(seed % 360) / 360,
                saturation: 0.72,
                brightness: 0.94
            )
        }
    }
}
