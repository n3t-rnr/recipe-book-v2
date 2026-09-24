<script lang="ts">
  // Profile choice /profil (F-02): a device sees it once, then it starts in the list. So this route is
  // its own chunk (App.svelte loads it like the other lazy routes: "Erneut versuchen" after a failed
  // load, a new attempt once the server answers again) and the entry keeps the NF-01 budget for shell
  // and list. The screen itself is components/screens/ProfileChoice.svelte.
  import ProfileChoice from '../components/screens/ProfileChoice.svelte';
</script>

<ProfileChoice />
