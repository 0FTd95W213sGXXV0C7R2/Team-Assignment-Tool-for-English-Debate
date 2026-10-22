export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { motion, tournament, year, action, motions } = req.body;

    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;

    if (!token || !owner || !repo) {
        return res.status(500).json({ error: 'Server environment variables are not set properly.' });
    }

    const path = 'motions.json';
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    try {
        const getRes = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Debate-Tool'
            }
        });

        if (!getRes.ok) {
            throw new Error('Failed to fetch motions.json from GitHub');
        }

        const fileData = await getRes.json();
        const sha = fileData.sha;
        let currentContent = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf8'));

        let commitMessage = '';

        if (action === 'overwrite' && Array.isArray(motions)) {
            // まとめて上書き（追加・編集・削除共通）
            currentContent = motions;
            commitMessage = 'Update, edit, or delete motions via web tool';
        } else {
            // 単体追加用（旧形式の互換性維持）
            if (!motion) {
                return res.status(400).json({ error: 'Motion is required' });
            }
            currentContent.push({
                motion: motion.trim(),
                tournament: tournament ? tournament.trim() : '',
                year: year ? year.trim() : ''
            });
            commitMessage = `Add new motion via web tool: ${motion.substring(0, 30)}...`;
        }

        const updatedContentBase64 = Buffer.from(JSON.stringify(currentContent, null, 2)).toString('base64');

        const putRes = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Debate-Tool',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: commitMessage,
                content: updatedContentBase64,
                sha: sha
            })
        });

        if (!putRes.ok) {
            const errorData = await putRes.json();
            throw new Error(errorData.message || 'Failed to update motions.json on GitHub');
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
