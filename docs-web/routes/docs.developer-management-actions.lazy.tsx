import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperManagementActionsContent from '../content/docs/developer-management-actions.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-management-actions')({
  component: () => (
    <DocsPage id="developer-management-actions">
      <DeveloperManagementActionsContent />
    </DocsPage>
  )
})
