<script lang="ts">
let _count: number = 0;

function _increment() {
  _count += 1;
}
</script>

<button on:click={increment}>
  Count: {count}
</button>
