<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    children,
    gap = 'm'
  }: {
    children: Snippet
    gap?: 'l' | 'm' | 's' | 'xl' | 'xs' | 'xxl'
  } = $props()
</script>

<div class="stack" style:gap={gap}>
  {@render children()}
</div>
