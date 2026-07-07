import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesGuardrailsContent from '../content/docs/settings-subcategories-guardrails.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-guardrails')({
  component: () => (
    <DocsPage id="settings-subcategories-guardrails">
      <SettingsSubcategoriesGuardrailsContent />
    </DocsPage>
  )
})
