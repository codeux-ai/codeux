import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsWorkspaceHygieneContent from '../content/docs/settings-workspace-hygiene.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-workspace-hygiene')({
  component: () => (
    <DocsPage id="settings-workspace-hygiene">
      <SettingsWorkspaceHygieneContent />
    </DocsPage>
  )
})
