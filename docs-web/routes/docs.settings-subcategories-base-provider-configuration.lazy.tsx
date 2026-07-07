import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesBaseProviderConfigurationContent from '../content/docs/settings-subcategories-base-provider-configuration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-base-provider-configuration')({
  component: () => (
    <DocsPage id="settings-subcategories-base-provider-configuration">
      <SettingsSubcategoriesBaseProviderConfigurationContent />
    </DocsPage>
  )
})
