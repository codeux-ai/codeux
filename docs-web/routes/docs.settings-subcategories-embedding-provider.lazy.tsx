import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesEmbeddingProviderContent from '../content/docs/settings-subcategories-embedding-provider.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-embedding-provider')({
  component: () => (
    <DocsPage id="settings-subcategories-embedding-provider">
      <SettingsSubcategoriesEmbeddingProviderContent />
    </DocsPage>
  )
})
