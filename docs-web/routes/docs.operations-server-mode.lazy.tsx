import { createLazyFileRoute } from '@tanstack/react-router'
import OperationsServerModeContent from '../content/docs/operations-server-mode.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/operations-server-mode')({
  component: () => (
    <DocsPage id="operations-server-mode">
      <OperationsServerModeContent />
    </DocsPage>
  )
})
