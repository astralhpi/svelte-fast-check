/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    // This should filter out state_referenced_locally warnings
    warningFilter: (warning) => {
      return warning.code !== 'state_referenced_locally';
    }
  }
};

export default config;
