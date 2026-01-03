<script lang="ts">
  import { page } from './mock-stores';

  // ERROR: Using $page (store syntax) when page is not a store
  /* 
   * Multi-line comment mentioning $page
   * should be skipped
   */
  // This should trigger TS2769: No overload matches this call
  const currentPath = $page.url.pathname;
</script>

<p>Current path: {currentPath}</p>
