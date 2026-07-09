import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsWorkspaceVisibilityContent from '../content/docs/settings-workspace-visibility.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-workspace-visibility')({
  component: () => (
    <DocsPage id="settings-workspace-visibility">
      <SettingsWorkspaceVisibilityContent />
    </DocsPage>
  )
})
