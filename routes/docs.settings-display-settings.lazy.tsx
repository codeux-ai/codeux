import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsDisplaySettingsContent from '../content/docs/settings-display-settings.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-display-settings')({
  component: () => (
    <DocsPage id="settings-display-settings">
      <SettingsDisplaySettingsContent />
    </DocsPage>
  )
})
