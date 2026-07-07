import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureSprintEngineContent from '../content/docs/architecture-sprint-engine.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-sprint-engine')({
  component: () => (
    <DocsPage id="architecture-sprint-engine">
      <ArchitectureSprintEngineContent />
    </DocsPage>
  )
})
