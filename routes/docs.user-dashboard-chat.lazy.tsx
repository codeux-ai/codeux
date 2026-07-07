import { createLazyFileRoute } from '@tanstack/react-router'
import UserDashboardChatContent from '../content/docs/user-dashboard-chat.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-dashboard-chat')({
  component: () => (
    <DocsPage id="user-dashboard-chat">
      <UserDashboardChatContent />
    </DocsPage>
  )
})
