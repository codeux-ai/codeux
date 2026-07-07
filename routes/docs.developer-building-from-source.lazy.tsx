import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperBuildingFromSourceContent from '../content/docs/developer-building-from-source.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-building-from-source')({
  component: () => (
    <DocsPage id="developer-building-from-source">
      <DeveloperBuildingFromSourceContent />
    </DocsPage>
  )
})
