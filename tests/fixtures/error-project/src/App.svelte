<script lang="ts">
  // Type error: assigning string to number
  let count: number = "not a number";

  function increment(): void {
    // Type error: argument type mismatch
    count = "still not a number";
  }

  export { count, increment };
</script>
