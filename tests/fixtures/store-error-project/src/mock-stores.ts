// Mock SvelteKit stores - these are NOT stores, they are runes in Svelte 5
// Using $page (store syntax) instead of page (rune) should cause an error

// This simulates the Svelte 5 behavior where page is a rune, not a store
export const page = {
  url: {
    pathname: '/test',
  },
};

// NOT a store - no subscribe method
// Using $page will fail because page is not a valid store
