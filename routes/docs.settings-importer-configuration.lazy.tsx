import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsImporterConfigurationContent from '../content/docs/settings-importer-configuration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-importer-configuration')({
  component: () => (
    <DocsPage id="settings-importer-configuration">
      <SettingsImporterConfigurationContent />
    </DocsPage>
  )
})
