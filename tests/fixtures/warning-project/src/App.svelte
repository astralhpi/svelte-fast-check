<script lang="ts">
// This should trigger 'state_referenced_locally' warning
// Capturing $state() value in a local variable only captures initial value
let count = $state(0);

// BAD: This only captures the initial value of count
const _doubled = count * 2;

function _increment() {
  count += 1;
}
</script>

<button onclick={increment}>
  Count: {count}, Doubled: {doubled}
</button>
