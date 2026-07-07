import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesImporterConfigurationContent from '../content/docs/settings-subcategories-importer-configuration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-importer-configuration')({
  component: () => (
    <DocsPage id="settings-subcategories-importer-configuration">
      <SettingsSubcategoriesImporterConfigurationContent />
    </DocsPage>
  )
})
