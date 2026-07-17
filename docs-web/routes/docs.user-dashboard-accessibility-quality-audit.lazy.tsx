import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardAccessibilityQualityAuditContent from '../content/docs/user-dashboard-accessibility-quality-audit.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-accessibility-quality-audit')({
  component: () => (
    <DocsPage id="user-dashboard-accessibility-quality-audit">
      <UserDashboardAccessibilityQualityAuditContent />
    </DocsPage>
  )
})
