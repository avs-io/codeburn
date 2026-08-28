import Testing
@testable import CodeBurnMenubar

@Suite("Provider connection catalog")
struct ProviderConnectionCatalogTests {
    @Test("pins the complete provider inventory")
    func pinnedReferenceInventory() {
        #expect(ProviderConnectionCatalog.inventoryRevision == "714bff00815f0d98ae206e781d563595129ba185")
        #expect(ProviderConnectionCatalog.providers.count == 69)
        #expect(ProviderConnectionCatalog.providers.map(\.id) == [
            "codex", "openai", "azureopenai", "claude", "clinepass", "cursor", "opencode",
            "opencodego", "alibaba", "alibabatokenplan", "qwencloud", "factory", "fireworks",
            "gemini", "antigravity", "copilot", "devin", "zai", "minimax", "manus", "kimi",
            "kilo", "kiro", "vertexai", "augment", "jetbrains", "moonshot", "amp", "t3chat",
            "ollama", "synthetic", "openrouter", "elevenlabs", "warp", "windsurf", "zed",
            "perplexity", "mimo", "doubao", "sakana", "abacus", "mistral", "deepseek",
            "deepinfra", "codebuff", "crof", "venice", "commandcode", "qoder", "stepfun",
            "bedrock", "grok", "groq", "llmproxy", "litellm", "deepgram", "poe", "chutes",
            "neuralwatt", "clawrouter", "longcat", "sub2api", "wayfinder", "zenmux", "aiand",
            "zoommate", "xai", "notion", "ibmbob",
        ])
    }

    @Test("provider IDs are unique and every provider declares a connection path")
    func uniqueAndConnectable() {
        let providers = ProviderConnectionCatalog.providers
        #expect(Set(providers.map(\.id)).count == providers.count)
        #expect(providers.allSatisfy { !$0.sourceModes.isEmpty })
        #expect(providers.allSatisfy { !$0.authMethods.isEmpty })
        #expect(providers.allSatisfy { ProviderConnectionCatalog.entry(id: $0.id) == Optional($0) })
    }

    @Test("pins source-mode coverage")
    func pinnedSourceModeCoverage() {
        let providers = ProviderConnectionCatalog.providers
        #expect(providers.count(with: .automatic) == 69)
        #expect(providers.count(with: .web) == 31)
        #expect(providers.count(with: .cli) == 14)
        #expect(providers.count(with: .oauth) == 5)
        #expect(providers.count(with: .api) == 44)
    }

    @Test("pins every live CodeBurn quota adapter")
    func currentLiveAdapters() {
        let live = ProviderConnectionCatalog.providers
            .filter(\.hasLiveCodeBurnQuotaAdapter)
            .map(\.id)
            .sorted()
        #expect(live == ["antigravity", "claude", "clinepass", "codex", "copilot", "gemini", "kimi"])
    }

    @Test("manual cookie and workspace fields are explicit catalog metadata")
    func explicitCapabilityMetadata() {
        #expect(Set(ProviderConnectionCatalog.providers.filter(\.supportsManualCookie).map(\.id)) == [
            "abacus", "alibaba", "alibabatokenplan", "amp", "augment", "commandcode", "copilot",
            "cursor", "factory", "grok", "kimi", "longcat", "manus", "minimax", "mimo", "mistral",
            "notion", "ollama", "opencode", "opencodego", "perplexity", "qoder", "qwencloud",
            "stepfun", "t3chat", "windsurf", "zoommate",
        ])
        #expect(Set(ProviderConnectionCatalog.providers.filter(\.supportsWorkspaceID).map(\.id)) == [
            "azureopenai", "deepgram", "devin", "notion", "openai", "opencode", "opencodego", "xai",
        ])

        #expect(ProviderConnectionCapabilities.supportsManualCookie("commandcode"))
        #expect(ProviderConnectionCapabilities.supportsManualCookie("opencode"))
        #expect(!ProviderConnectionCapabilities.supportsManualCookie("devin"))
        #expect(!ProviderConnectionCapabilities.supportsManualCookie("groq"))
        #expect(ProviderConnectionCapabilities.supportsWorkspaceID("notion"))
        #expect(ProviderConnectionCapabilities.supportsWorkspaceID("deepgram"))
        #expect(!ProviderConnectionCapabilities.supportsWorkspaceID("clinepass"))
        #expect(!ProviderConnectionCapabilities.supportsManualCookie("missing-provider"))
        #expect(!ProviderConnectionCapabilities.supportsWorkspaceID("missing-provider"))
    }
}

private extension Array where Element == ProviderConnectionCatalogEntry {
    func count(with sourceMode: ProviderReferenceSourceMode) -> Int {
        count { $0.sourceModes.contains(sourceMode) }
    }
}
