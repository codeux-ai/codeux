import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperSprintFormatContent from '../content/docs/developer-sprint-format.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-sprint-format')({
  component: () => (
    <DocsPage id="developer-sprint-format">
      <DeveloperSprintFormatContent />
    </DocsPage>
  )
})
