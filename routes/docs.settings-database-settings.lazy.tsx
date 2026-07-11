import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsDatabaseSettingsContent from '../content/docs/settings-database-settings.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-database-settings')({
  component: () => (
    <DocsPage id="settings-database-settings">
      <SettingsDatabaseSettingsContent />
    </DocsPage>
  )
})
