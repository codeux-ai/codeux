import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesProviderIntegrationContent from '../content/docs/settings-subcategories-provider-integration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-provider-integration')({
  component: () => (
    <DocsPage id="settings-subcategories-provider-integration">
      <SettingsSubcategoriesProviderIntegrationContent />
    </DocsPage>
  )
})
