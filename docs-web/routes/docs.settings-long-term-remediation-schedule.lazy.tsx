import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsLongTermRemediationScheduleContent from '../content/docs/settings-long-term-remediation-schedule.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-long-term-remediation-schedule')({
  component: () => (
    <DocsPage id="settings-long-term-remediation-schedule">
      <SettingsLongTermRemediationScheduleContent />
    </DocsPage>
  )
})
