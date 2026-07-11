import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureDashboardNotificationFeedContent from '../content/docs/architecture-dashboard-notification-feed.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-dashboard-notification-feed')({
  component: () => (
    <DocsPage id="architecture-dashboard-notification-feed">
      <ArchitectureDashboardNotificationFeedContent />
    </DocsPage>
  )
})
