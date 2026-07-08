import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsEmbeddingProviderContent from '../content/docs/settings-embedding-provider.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-embedding-provider')({
  component: () => (
    <DocsPage id="settings-embedding-provider">
      <SettingsEmbeddingProviderContent />
    </DocsPage>
  )
})
