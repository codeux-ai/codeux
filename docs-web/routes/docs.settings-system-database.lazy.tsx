import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSystemDatabaseContent from '../content/docs/settings-system-database.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-system-database')({
  component: () => (
    <DocsPage id="settings-system-database">
      <SettingsSystemDatabaseContent />
    </DocsPage>
  )
})
