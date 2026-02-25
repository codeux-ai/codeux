### Planning Phase for Sprint {{sprint_number}}

Created directory: `{{subtasks_dir}}`.

{{planning_guide_block}}**Instructions for the calling Agent:**
1. Read `sprints/sprint-{{sprint_number}}.md`.
2. Break the sprint into small, well-planned tasks.
3. For each task, create a `.md` file in the subtasks directory with this format:

```markdown
title: Task Title
depends_on: [task_id_1, task_id_2]
is_independent: true
merged: false
prompt:
Detailed instructions for Jules.
```
