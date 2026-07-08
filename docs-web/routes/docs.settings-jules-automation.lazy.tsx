import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsJulesAutomationContent from '../content/docs/settings-jules-automation.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-jules-automation')({
  component: () => (
    <DocsPage id="settings-jules-automation">
      <SettingsJulesAutomationContent />
    </DocsPage>
  )
})
