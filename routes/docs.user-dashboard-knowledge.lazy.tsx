import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardKnowledgeContent from '../content/docs/user-dashboard-knowledge.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-knowledge')({
  component: () => (
    <DocsPage id="user-dashboard-knowledge">
      <UserDashboardKnowledgeContent />
    </DocsPage>
  )
})
