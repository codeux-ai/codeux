import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsConfigurationAndStorageContent from '../content/docs/settings-configuration-and-storage.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-configuration-and-storage')({
  component: () => (
    <DocsPage id="settings-configuration-and-storage">
      <SettingsConfigurationAndStorageContent />
    </DocsPage>
  )
})
