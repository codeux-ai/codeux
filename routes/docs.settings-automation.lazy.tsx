import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsAutomationContent from '../content/docs/settings-automation.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-automation')({
  component: () => (
    <DocsPage id="settings-automation">
      <SettingsAutomationContent />
    </DocsPage>
  )
})
