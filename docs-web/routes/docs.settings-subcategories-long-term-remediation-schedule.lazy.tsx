import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesLongTermRemediationScheduleContent from '../content/docs/settings-subcategories-long-term-remediation-schedule.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-long-term-remediation-schedule')({
  component: () => (
    <DocsPage id="settings-subcategories-long-term-remediation-schedule">
      <SettingsSubcategoriesLongTermRemediationScheduleContent />
    </DocsPage>
  )
})
