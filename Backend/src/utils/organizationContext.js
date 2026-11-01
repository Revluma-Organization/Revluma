// Membership is authoritative for old and new accounts alike. Ownership columns
// are never a substitute for active membership or a reason to promote a role.
async function resolveMembership(prisma, userId, organizationId) {
  if (organizationId != null && (typeof organizationId !== 'string' || !organizationId.trim())) {
    throw Object.assign(new Error('Invalid organisation selection.'), { statusCode: 400 });
  }
  const memberships = await prisma.organization_members.findMany({
    where: { user_id: userId, status: 'active' },
    select: { id: true, organization_id: true, role: true, status: true },
  });
  if (organizationId) {
    const selected = memberships.find(member => member.organization_id === organizationId);
    if (!selected) throw Object.assign(new Error('Active organisation membership required.'), { statusCode: 403 });
    return selected;
  }
  // Multiple memberships require an explicit choice. Never silently switch roles.
  return memberships.length === 1 ? memberships[0] : null;
}

async function requireMembership(prisma, userId, organizationId) {
  const membership = await resolveMembership(prisma, userId, organizationId);
  if (!membership) throw Object.assign(new Error('Select an active organisation workspace.'), { statusCode: 403 });
  return membership;
}

function membershipContext(membership) {
  return { active_organization_id: membership?.organization_id || null, role: membership?.role || 'unknown' };
}

module.exports = { resolveMembership, requireMembership, membershipContext };
