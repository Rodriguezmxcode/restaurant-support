type ProjectCreatorIdentity = {
  id?: string;
  email?: string;
};

const projectCreatorUserIds = new Set([
  'usr-founder-roberto',
  'usr-roberto-ops',
  'usr-jacob',
]);

const projectCreatorEmails = new Set([
  'rodriguez.evolife@gmail.com',
  'roberto@puertovallartausa.com',
  'jacob@puertovallartausa.com',
]);

export function canCreateProjectsForIdentity(user: ProjectCreatorIdentity) {
  const id = user.id?.trim();
  const email = user.email?.trim().toLowerCase();
  return Boolean(
    (id && projectCreatorUserIds.has(id)) ||
    (email && projectCreatorEmails.has(email)),
  );
}
